"""생성된 가명처리 코드 패키지 실행 검증.

패키지(zip 또는 폴더)의 deid.py 를 합성 샘플(UTF-8·CP949 등)에 실제로 실행하고 다음을 확인한다.
  1) 실행 성공(종료코드 0)  2) 원본 파일 SHA-256 불변  3) 삭제 기법 컬럼이 결과에 없음
  4) 가명키 컬럼이 32자리 16진수  5) 연도만 컬럼이 4자리  6) regex_pii.py 가 PII를 치환
  7) 같은 솔트로 두 번 실행한 결과가 같음(재현성)

사용법:
    python tools/verify_generated.py <패키지.zip|폴더> <샘플.csv> [<샘플2.csv> ...]
    (인자 없이 실행하면 tests/_out/deid_pkg_crc.zip 과 samples/ 합성 샘플을 쓴다)
"""
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

from common import ROOT, setup_console


def sha(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def load_pkg(src, work):
    src = Path(src)
    if src.is_dir():
        shutil.copytree(src, work, dirs_exist_ok=True)
    else:
        with zipfile.ZipFile(src) as z:
            z.extractall(work)
    return json.loads((work / "매핑_가명처리_요약.json").read_text(encoding="utf-8"))


def run_once(work, sample, out, env):
    code = (work / "deid.py").read_text(encoding="utf-8")
    # 치환 문자열의 역슬래시(Windows 경로)가 해석되지 않도록 함수로 넘긴다
    code = re.sub(r'^INPUT = Path\(.*\)$', lambda m: "INPUT = Path(" + json.dumps(str(sample)) + ")", code, count=1, flags=re.M)
    code = re.sub(r'^OUTPUT = Path\(.*\)$', lambda m: "OUTPUT = Path(" + json.dumps(str(out)) + ")", code, count=1, flags=re.M)
    script = work / "deid_test.py"
    script.write_text(code, encoding="utf-8")
    return subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding="utf-8", env=env)


def check_sample(work, summary, sample, fails):
    import pandas as pd
    env = dict(os.environ, KCURE_SALT="verify-salt-0001", PYTHONIOENCODING="utf-8")
    before = sha(sample)
    outs = []
    for k in (1, 2):
        out = work / f"out_{Path(sample).stem}_{k}.csv"
        r = run_once(work, sample, out, env)
        if r.returncode != 0:
            fails.append(f"{Path(sample).name}: 실행 실패\n{r.stdout}\n{r.stderr}")
            return
        outs.append(out)
    if sha(sample) != before:
        fails.append(f"{Path(sample).name}: 원본 파일이 바뀌었습니다")
    if sha(outs[0]) != sha(outs[1]):
        fails.append(f"{Path(sample).name}: 같은 솔트로 결과가 다릅니다(재현성 실패)")
    df = pd.read_csv(outs[0], dtype=str, encoding="utf-8-sig", keep_default_na=False)
    if Path(sample).suffix.lower() in (".xlsx", ".xlsm"):
        src_cols = set(pd.read_excel(sample, dtype=str, nrows=0).columns)
    else:
        src_cols = set(pd.read_csv(sample, dtype=str, nrows=0, encoding="cp949" if _is_cp949(sample) else "utf-8-sig").columns)
    n_checked = 0
    for c in summary["columns"]:
        col = c["col"]
        if col not in src_cols:
            continue
        if c["status"] != "승인" or c["technique"] == "DELETE":
            if col in df.columns:
                fails.append(f"{Path(sample).name}: {col} ({c['technique']}/{c['status']}) 가 결과에 남아 있음")
            continue
        if col not in df.columns:
            fails.append(f"{Path(sample).name}: 승인 컬럼 {col} 가 결과에 없음")
            continue
        vals = [v for v in df[col] if v]
        if c["technique"] == "HASH_SALT":
            if not all(re.fullmatch(r"[0-9a-f]{32}", v) for v in vals):
                fails.append(f"{Path(sample).name}: {col} 가명키 형식 오류")
            # 변환기(FHIR·KR CDI)와 같은 방식: sha256(솔트 + '|' + 값)[:32]
            src_df = read_src(sample)
            want = [hashlib.sha256((env["KCURE_SALT"] + "|" + str(v).strip()).encode("utf-8")).hexdigest()[:32] if str(v).strip() else ""
                    for v in src_df[col].fillna("")]
            if list(df[col]) != want:
                fails.append(f"{Path(sample).name}: {col} 가명키가 변환기 방식과 다릅니다")
        if c["technique"] == "YEAR_ONLY" and not all(re.fullmatch(r"(19|20)\d{2}", v) for v in vals):
            fails.append(f"{Path(sample).name}: {col} 연도 형식 오류 {vals[:3]}")
        if c["technique"] == "DATE_SHIFT" and not all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", v) for v in vals):
            fails.append(f"{Path(sample).name}: {col} 날짜 이동 형식 오류 {vals[:3]}")
        n_checked += 1
    print(f"  {Path(sample).name}: 행 {len(df)} · 결과 컬럼 {len(df.columns)} · 점검 컬럼 {n_checked} · 원본 해시 불변")


def read_src(p):
    import pandas as pd
    if Path(p).suffix.lower() in (".xlsx", ".xlsm"):
        return pd.read_excel(p, dtype=str)
    return pd.read_csv(p, dtype=str, keep_default_na=False, encoding="cp949" if _is_cp949(p) else "utf-8-sig")


def _is_cp949(p):
    try:
        Path(p).read_text(encoding="utf-8-sig")
        return False
    except UnicodeDecodeError:
        return True


def check_regex(work, fails):
    src = work / "pii_in.txt"
    src.write_text("환자명: 홍길동, 등록번호 0012345, 2026.03.02 내원. 연락처 010-1234-5678. Hodgkin lymphoma 의증. 주민번호 900101-1234567", encoding="utf-8")
    dst = work / "pii_out.txt"
    r = subprocess.run([sys.executable, str(work / "regex_pii.py"), str(src), str(dst)], capture_output=True, text=True, encoding="utf-8",
                       env=dict(os.environ, PYTHONIOENCODING="utf-8"))
    if r.returncode != 0:
        fails.append("regex_pii.py 실행 실패\n" + r.stderr)
        return
    out = dst.read_text(encoding="utf-8")
    for leak in ("홍길동", "0012345", "010-1234-5678", "900101-1234567", "2026.03.02"):
        if leak in out:
            fails.append(f"regex_pii.py: '{leak}' 가 치환되지 않음 → {out}")
    if "Hodgkin" not in out:
        fails.append("regex_pii.py: 예외어(Hodgkin)가 지워짐")
    print("  regex_pii.py:", out)


def main():
    setup_console()
    args = sys.argv[1:]
    pkg = args[0] if args else str(ROOT / "tests" / "_out" / "deid_pkg_crc.zip")
    samples = args[1:] or [str(ROOT / "samples" / "합성샘플_대장암_원천영문컬럼.csv")]
    fails = []
    with tempfile.TemporaryDirectory(prefix="kcure_verify_") as t:
        work = Path(t)
        summary = load_pkg(pkg, work)
        print(f"패키지 {pkg}: 컬럼 {len(summary['columns'])} · 승인 {sum(1 for c in summary['columns'] if c['status'] == '승인')}")
        for s in samples:
            check_sample(work, summary, s, fails)
        check_regex(work, fails)
    if fails:
        print("\n[실패]")
        for f in fails:
            print(" -", f)
        sys.exit(1)
    print("검증 통과")


if __name__ == "__main__":
    main()
